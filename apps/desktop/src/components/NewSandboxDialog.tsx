import { useEffect, useRef, useState } from "react";
import type { ImageView } from "../../sidecar/protocol.ts";
import type {
  SidecarApi,
  SidecarClient,
} from "../lib/sidecar-client.ts";

type Mode = "existing" | "build";

const EXAMPLE_DOCKERFILES: Record<string, string> = {
  "alpine:3.19": "FROM alpine:3.19\n",
  "alpine + curl": `FROM alpine:3.19
RUN apk add --no-cache curl ca-certificates
`,
  "ubuntu + python": `FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \\
    python3 python3-pip ca-certificates \\
 && rm -rf /var/lib/apt/lists/*
`,
};

export function NewSandboxDialog({
  api,
  client,
  onClose,
}: {
  api: SidecarApi;
  client: SidecarClient;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("existing");
  const [images, setImages] = useState<ImageView[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [pickedSnapshot, setPickedSnapshot] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [buildTag, setBuildTag] = useState("my-sandbox:dev");
  const [dockerfile, setDockerfile] = useState(EXAMPLE_DOCKERFILES["alpine:3.19"]!);
  // String-typed so an in-progress field (`""`, `"10"`, etc.) doesn't keep
  // re-coercing through NaN on every keystroke. Validated to a positive
  // integer at submit time; falls back to the orchestrator's default
  // (1024 MiB) when blank.
  const [memoryInput, setMemoryInput] = useState("1024");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressLog, setProgressLog] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const refreshImages = async () => {
    setImagesLoading(true);
    setImagesError(null);
    try {
      const list = await api.listImages();
      setImages(list);
      setSelected((cur) => {
        const valid = new Set(list.map((i) => i.snapshotName));
        const next = new Set<string>();
        for (const s of cur) if (valid.has(s)) next.add(s);
        return next;
      });
      setPickedSnapshot((cur) => {
        if (cur && list.some((i) => i.snapshotName === cur)) return cur;
        return list[0]?.snapshotName ?? "";
      });
    } catch (err) {
      setImagesError(err instanceof Error ? err.message : String(err));
    } finally {
      setImagesLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refreshImages();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const toggleSelected = (snapshotName: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(snapshotName)) next.delete(snapshotName);
      else next.add(snapshotName);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(images.map((i) => i.snapshotName)));
  const clearSelection = () => setSelected(new Set());

  const deleteImages = async (snapshotNames: string[]) => {
    if (snapshotNames.length === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const { errors } = await api.removeImages(snapshotNames);
      if (errors.length > 0) {
        setError(
          `failed to delete ${errors.length} image(s):\n` +
            errors.map((e) => `  ${e.snapshotName}: ${e.message}`).join("\n"),
        );
      }
      await refreshImages();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  // Stream build progress events into the visible log.
  useEffect(() => {
    const off = client.on("image:progress", (p) => {
      setProgressLog((cur) => {
        const line = p.error
          ? `error: ${p.error}`
          : p.step ?? (p.done ? "done" : "...");
        return [...cur, line];
      });
    });
    return () => off();
  }, [client]);

  // Parse the memory field once per render. `undefined` means "use the
  // orchestrator default"; a valid positive integer overrides.
  const parsedMemory: number | undefined = (() => {
    const trimmed = memoryInput.trim();
    if (trimmed === "") return undefined;
    const n = Number(trimmed);
    return Number.isInteger(n) && n > 0 ? n : NaN;
  })();
  const memoryInvalid = Number.isNaN(parsedMemory);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setProgressLog([]);
    const memory = memoryInvalid ? undefined : parsedMemory;
    try {
      if (mode === "build") {
        const { snapshotName } = await api.buildImage(
          buildTag,
          dockerfile,
          memory,
        );
        // Boot the exact snapshot we just built. Passing buildTag here would
        // prefix-resolve against every snapshot sharing the tag (the user
        // typically iterates on the Dockerfile under the same tag), and a
        // cache hit doesn't refresh createdAt — so the newest-wins tiebreak
        // can return a stale snapshot whose Dockerfile is different.
        await api.createSandbox(snapshotName, memory);
      } else {
        const picked = images.find((i) => i.snapshotName === pickedSnapshot);
        if (!picked) throw new Error("pick an image first");
        // Boot from the exact snapshot to avoid prefix-collision ambiguity.
        await api.createSandbox(picked.snapshotName, memory);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    !deleting &&
    !memoryInvalid &&
    (mode === "build"
      ? buildTag.trim().length > 0 && dockerfile.trim().length > 0
      : pickedSnapshot.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-2xl w-full max-h-[85vh] flex flex-col shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b-2 border-[var(--color-ink)] px-6 py-4 flex items-center justify-between">
          <h2
            className="text-2xl"
            style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
          >
            new sandbox
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-[var(--color-ash)] hover:text-[var(--color-ink)] text-xl leading-none disabled:opacity-30"
            aria-label="close"
          >
            ×
          </button>
        </header>

        <div className="border-b border-[var(--color-ink)]/15 px-6 flex">
          {(["existing", "build"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={busy}
              className={`px-4 py-3 text-[10px] uppercase tracking-[0.3em] border-b-2 disabled:opacity-50 ${
                mode === m
                  ? "border-[var(--color-amber)] text-[var(--color-ink)]"
                  : "border-transparent text-[var(--color-ash)] hover:text-[var(--color-ink)]"
              }`}
              style={{ fontFamily: "var(--font-body)" }}
            >
              {m === "existing" ? "boot existing image" : "build from dockerfile"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <MemoryField
            value={memoryInput}
            onChange={setMemoryInput}
            invalid={memoryInvalid}
          />
          {mode === "existing" ? (
            <ExistingImagePicker
              images={images}
              loading={imagesLoading}
              loadError={imagesError}
              picked={pickedSnapshot}
              onPick={setPickedSnapshot}
              selected={selected}
              onToggleSelected={toggleSelected}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              onDeleteSelected={() => void deleteImages([...selected])}
              onDeleteAll={() => void deleteImages(images.map((i) => i.snapshotName))}
              deleting={deleting}
              busy={busy}
            />
          ) : (
            <BuildForm
              buildTag={buildTag}
              setBuildTag={setBuildTag}
              dockerfile={dockerfile}
              setDockerfile={setDockerfile}
            />
          )}

          {progressLog.length > 0 && (
            <pre
              className="bg-[var(--color-ink)] text-[var(--color-paper)] p-3 text-[11px] leading-relaxed max-h-32 overflow-y-auto"
              style={{ fontFamily: "var(--font-terminal)" }}
              data-testid="build-progress"
            >
              {progressLog.join("\n")}
            </pre>
          )}

          {error && (
            <div
              className="border border-[#dc2626]/40 bg-[#dc2626]/10 text-[#7f1d1d] px-3 py-2 text-xs whitespace-pre-wrap"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {error}
            </div>
          )}
        </div>

        <footer className="border-t border-[var(--color-ink)]/15 px-6 py-4 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-xs uppercase tracking-[0.25em] px-3 py-2 text-[var(--color-ash)] hover:text-[var(--color-ink)] disabled:opacity-30"
            style={{ fontFamily: "var(--font-body)" }}
          >
            cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="text-xs uppercase tracking-[0.25em] px-4 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-amber)] hover:text-[var(--color-ink)] disabled:opacity-50 transition-colors"
            style={{ fontFamily: "var(--font-body)" }}
            data-testid="confirm-create"
          >
            {busy
              ? "working…"
              : mode === "build"
                ? "build + boot →"
                : "boot →"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ExistingImagePicker({
  images,
  loading,
  loadError,
  picked,
  onPick,
  selected,
  onToggleSelected,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
  onDeleteAll,
  deleting,
  busy,
}: {
  images: ImageView[];
  loading: boolean;
  loadError: string | null;
  picked: string;
  onPick: (snapshotName: string) => void;
  selected: Set<string>;
  onToggleSelected: (snapshotName: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onDeleteAll: () => void;
  deleting: boolean;
  busy: boolean;
}) {
  if (loading) {
    return (
      <p
        className="text-[10px] uppercase tracking-[0.25em] text-[var(--color-ash)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        loading images…
      </p>
    );
  }

  if (loadError) {
    return (
      <div
        className="border border-[#dc2626]/40 bg-[#dc2626]/10 text-[#7f1d1d] px-3 py-2 text-xs"
        style={{ fontFamily: "var(--font-body)" }}
      >
        couldn't list images: {loadError}
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div
        className="text-xs text-[var(--color-ash)] border border-[var(--color-ink)]/15 px-3 py-3"
        style={{ fontFamily: "var(--font-body)" }}
      >
        no images built yet — switch to <em>build from dockerfile</em> to
        create your first one.
      </div>
    );
  }

  const disabled = deleting || busy;
  const allChecked = selected.size === images.length;
  const someChecked = selected.size > 0;

  // Inline "arm-then-fire" confirmation. window.confirm() is not reliable in
  // Tauri webviews — it silently returns false — so we use a two-click flow
  // gated on local state. The armed button auto-disarms after 3s.
  const [armed, setArmed] = useState<"selected" | "all" | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    },
    [],
  );

  const armOrFire = (which: "selected" | "all") => {
    if (armed === which) {
      if (armTimerRef.current) {
        clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
      setArmed(null);
      if (which === "all") onDeleteAll();
      else onDeleteSelected();
      return;
    }
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    setArmed(which);
    armTimerRef.current = setTimeout(() => {
      setArmed(null);
      armTimerRef.current = null;
    }, 3000);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <FieldLabel>pick an image</FieldLabel>
        <span
          className="text-[10px] text-[var(--color-ash)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {images.length} image{images.length === 1 ? "" : "s"}
          {someChecked ? ` · ${selected.size} selected` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em]">
        <button
          type="button"
          onClick={allChecked ? onClearSelection : onSelectAll}
          disabled={disabled}
          className="px-2 py-1 border border-[var(--color-ink)]/30 hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] disabled:opacity-40"
          style={{ fontFamily: "var(--font-body)" }}
          data-testid="select-all-toggle"
        >
          {allChecked ? "clear" : "select all"}
        </button>
        <button
          type="button"
          onClick={() => armOrFire("selected")}
          disabled={disabled || !someChecked}
          className={`px-2 py-1 border disabled:opacity-40 ${
            armed === "selected"
              ? "bg-[#dc2626] text-[var(--color-paper)] border-[#dc2626]"
              : "border-[#dc2626]/40 text-[#7f1d1d] hover:bg-[#dc2626] hover:text-[var(--color-paper)]"
          }`}
          style={{ fontFamily: "var(--font-body)" }}
          data-testid="delete-selected"
        >
          {armed === "selected"
            ? `confirm · delete ${selected.size}`
            : "delete selected"}
        </button>
        <button
          type="button"
          onClick={() => armOrFire("all")}
          disabled={disabled}
          className={`px-2 py-1 border disabled:opacity-40 ${
            armed === "all"
              ? "bg-[#dc2626] text-[var(--color-paper)] border-[#dc2626]"
              : "border-[#dc2626]/40 text-[#7f1d1d] hover:bg-[#dc2626] hover:text-[var(--color-paper)]"
          }`}
          style={{ fontFamily: "var(--font-body)" }}
          data-testid="delete-all"
        >
          {armed === "all"
            ? `confirm · delete all ${images.length}`
            : "delete all"}
        </button>
        {deleting && (
          <span
            className="text-[var(--color-ash)] normal-case tracking-normal text-[10px]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            deleting…
          </span>
        )}
      </div>
      <div className="border border-[var(--color-ink)]/30 divide-y divide-[var(--color-ink)]/10 max-h-72 overflow-y-auto bg-[var(--color-paper-deep)]">
        {images.map((img) => {
          const isPicked = picked === img.snapshotName;
          const isChecked = selected.has(img.snapshotName);
          return (
            <div
              key={img.snapshotName}
              className={`px-3 py-2 flex items-center gap-3 hover:bg-[var(--color-amber)]/10 ${
                isPicked ? "bg-[var(--color-amber)]/20" : ""
              }`}
              data-testid={`image-row-${img.snapshotName}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggleSelected(img.snapshotName)}
                disabled={disabled}
                className="accent-[var(--color-amber)] cursor-pointer disabled:cursor-not-allowed"
                aria-label={`select ${img.tag || img.snapshotName}`}
                data-testid={`image-checkbox-${img.snapshotName}`}
              />
              <button
                type="button"
                onClick={() => onPick(img.snapshotName)}
                disabled={disabled}
                className="flex-1 text-left flex items-baseline justify-between gap-3 disabled:opacity-50"
              >
                <span className="flex flex-col">
                  <span
                    className="text-sm"
                    style={{ fontFamily: "var(--font-terminal)" }}
                  >
                    {img.tag || img.snapshotName}
                  </span>
                  <span
                    className="text-[10px] text-[var(--color-ash)]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    from {img.baseImage} ·{" "}
                    {new Date(img.createdAt).toLocaleString()}
                  </span>
                </span>
                {isPicked && (
                  <span
                    className="text-[10px] uppercase tracking-[0.25em] text-[var(--color-amber)]"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    picked
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BuildForm({
  buildTag,
  setBuildTag,
  dockerfile,
  setDockerfile,
}: {
  buildTag: string;
  setBuildTag: (v: string) => void;
  dockerfile: string;
  setDockerfile: (v: string) => void;
}) {
  return (
    <>
      <FieldLabel>tag the new image</FieldLabel>
      <input
        value={buildTag}
        onChange={(e) => setBuildTag(e.target.value)}
        placeholder="my-sandbox:dev"
        className="w-full bg-[var(--color-paper-deep)] border border-[var(--color-ink)]/30 px-3 py-2 focus:outline-none focus:border-[var(--color-amber)]"
        style={{ fontFamily: "var(--font-terminal)" }}
        data-testid="build-tag-input"
      />
      <div className="flex items-center justify-between">
        <FieldLabel>dockerfile</FieldLabel>
        <div className="flex gap-2">
          {Object.keys(EXAMPLE_DOCKERFILES).map((name) => (
            <button
              key={name}
              onClick={() => setDockerfile(EXAMPLE_DOCKERFILES[name]!)}
              className="text-[9px] uppercase tracking-wider px-2 py-1 bg-[var(--color-paper-deep)] hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] transition-colors"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={dockerfile}
        onChange={(e) => setDockerfile(e.target.value)}
        rows={10}
        className="w-full bg-[var(--color-paper-deep)] border border-[var(--color-ink)]/30 px-3 py-2 focus:outline-none focus:border-[var(--color-amber)] resize-y"
        style={{ fontFamily: "var(--font-terminal)", fontSize: "0.8rem" }}
        data-testid="dockerfile-input"
      />
    </>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="block text-[10px] uppercase tracking-[0.3em] text-[var(--color-rust)] mb-1"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {children}
    </label>
  );
}

function MemoryField({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <FieldLabel>memory (MiB)</FieldLabel>
        <span
          className="text-[10px] text-[var(--color-ash)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          default 1024
        </span>
      </div>
      <input
        type="number"
        min={1}
        step={128}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="1024"
        className={`w-full bg-[var(--color-paper-deep)] border px-3 py-2 focus:outline-none ${
          invalid
            ? "border-[#dc2626]/60 focus:border-[#dc2626]"
            : "border-[var(--color-ink)]/30 focus:border-[var(--color-amber)]"
        }`}
        style={{ fontFamily: "var(--font-terminal)" }}
        data-testid="build-memory-input"
      />
      {invalid && (
        <p
          className="mt-1 text-[10px] text-[#7f1d1d]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          memory must be a positive integer (MiB)
        </p>
      )}
    </div>
  );
}
