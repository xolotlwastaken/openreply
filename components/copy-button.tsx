"use client";

import { useState } from "react";

interface CopyButtonProps {
  value: string;
  label: string;
  copiedLabel?: string;
  className?: string;
}

export default function CopyButton({
  value,
  label,
  copiedLabel = "Copied",
  className = "",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={className}
      aria-live="polite"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
