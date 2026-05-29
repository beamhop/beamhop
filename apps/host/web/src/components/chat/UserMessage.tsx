import type { UserMessage } from "../../types";
import { RichText } from "../RichText";

/** A single user message bubble. */
export function UserRow({ msg }: { msg: UserMessage }) {
  return (
    <div className="row user" data-testid={`msg-${msg.id}`}>
      <div className="ububble">
        <RichText text={msg.text} inline />
        {msg.images && msg.images > 0 ? (
          <div className="uimg mono">+{msg.images} image</div>
        ) : null}
      </div>
    </div>
  );
}
