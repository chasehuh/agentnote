"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useEffect, useId, useRef, useState } from "react";
import { SettingsIcon, SignOutIcon } from "./icons";

export function AccountMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const displayName =
    user?.fullName ||
    user?.primaryEmailAddress?.emailAddress ||
    "Account";
  const handle =
    user?.username ||
    user?.externalAccounts.find((account) => account.provider === "github")
      ?.username ||
    null;

  return (
    <div className="zed-account" ref={rootRef}>
      <button
        type="button"
        className="zed-account__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={displayName}
        onClick={() => setOpen((value) => !value)}
      >
        {isLoaded && user?.imageUrl ? (
          <img
            className="zed-account__avatar"
            src={user.imageUrl}
            alt=""
            width={22}
            height={22}
            draggable={false}
          />
        ) : (
          <span className="zed-account__avatar zed-account__avatar--fallback" />
        )}
      </button>

      {open ? (
        <div className="zed-account__menu" id={menuId} role="menu">
          <div className="zed-account__header">
            <p className="zed-account__name">{displayName}</p>
            {handle ? <p className="zed-account__handle">@{handle}</p> : null}
          </div>

          <div className="zed-account__items">
            <button
              type="button"
              className="zed-account__item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <SettingsIcon size={14} />
              <span>Settings</span>
            </button>
            <button
              type="button"
              className="zed-account__item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOut({ redirectUrl: "/login" });
              }}
            >
              <SignOutIcon size={14} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
