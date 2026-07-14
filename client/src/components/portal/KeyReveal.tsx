import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";

// The one and only moment a raw key is visible. Closing this dialog is
// irreversible — only the hash exists server-side.

export function KeyRevealDialog({ rawKey, onClose }: { rawKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(rawKey);
    setCopied(true);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Your new API key"
      description="Copy it now — this is the only time it will ever be shown. OpenKey stores only a hash."
    >
      <div className="mb-4 flex items-center gap-2 rounded border border-accent/30 bg-accent-faint p-3">
        <code className="min-w-0 flex-1 break-all font-mono text-xs text-zinc-100">{rawKey}</code>
        <Button size="icon" variant="ghost" aria-label="Copy key" onClick={copy}>
          {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onClose}>
          I've stored it
        </Button>
      </div>
    </Dialog>
  );
}
