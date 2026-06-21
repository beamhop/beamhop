import { useEffect, useState } from "react";
import { Logo, ArrowIcon } from "./icons";

export default function Nav() {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={"nav" + (stuck ? " is-stuck" : "")}>
      <a className="brand" href="#top" aria-label="Beamhop home">
        <Logo aria-hidden="true" />
        beamhop
      </a>

      <nav className="nav-links" aria-label="Sections">
        <a href="#floor">Floor</a>
        <a href="#security">Security</a>
        <a href="#automation">Automation</a>
        <a href="#connected">Connected work</a>
        <a href="#memory">Memory</a>
      </nav>

      <div className="nav-right">
        <span className="status-pill">
          <span className="status-dot" aria-hidden="true" />
          Network online
        </span>
        <a className="btn btn-primary" href="#start">
          Spin up an agent
          <ArrowIcon aria-hidden="true" />
        </a>
      </div>
    </header>
  );
}
