import React from "react";
import type { Message } from "../types";
import { groupForRender } from "../utils/messageGrouping";
import { AssistantTurn } from "./chat/AssistantTurn";
import { UserRow } from "./chat/UserMessage";

export interface ChatTranscriptProps {
  messages: Message[];
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

export function ChatTranscript({ messages, scrollRef, onScroll }: ChatTranscriptProps) {
  const items = groupForRender(messages);
  return (
    <div className="transcript" ref={scrollRef} onScroll={onScroll} data-testid="transcript">
      <div className="transcript-inner">
        {items.map((item) =>
          item.kind === "user" ? (
            <UserRow key={item.msg.id} msg={item.msg} />
          ) : (
            <AssistantTurn key={item.turnId} messages={item.messages} />
          ),
        )}
        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}
