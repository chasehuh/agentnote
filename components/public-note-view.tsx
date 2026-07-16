"use client";

import Link from "next/link";
import { CodeMirrorEditor } from "./codemirror-editor";

/** Anonymous read-only shell for `/p/{handle}/{token}` — Zed buffer chrome. */
export function PublicNoteView({
  title,
  body,
  authorHandle,
}: {
  title: string;
  body: string;
  authorHandle: string | null;
}) {
  return (
    <div className="zed-shell zed-shell--public">
      <header className="zed-titlebar">
        <span className="zed-titlebar__brand">agentnote</span>
        <span className="zed-titlebar__title" title={title}>
          {title}
        </span>
        {authorHandle ? (
          <span className="zed-titlebar__author" title={`@${authorHandle}`}>
            @{authorHandle}
          </span>
        ) : null}
        <div className="zed-titlebar__spacer" />
        <Link className="zed-titlebar__link" href="/login">
          Sign in
        </Link>
      </header>
      <div className="zed-workspace">
        <section className="zed-center">
          <div className="zed-editor">
            <div className="zed-buffer zed-buffer--cm">
              <CodeMirrorEditor
                value={body}
                wrap
                readOnly
                placeholderText=""
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
