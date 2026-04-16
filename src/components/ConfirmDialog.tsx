import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="mx-4 w-full max-w-md rounded-xl border border-white/10 bg-surface-light p-6 shadow-2xl shadow-black/40 animate-slide-up">
        <div className="mb-4 flex items-start gap-3">
          {danger && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neon-red/10">
              <AlertTriangle className="h-5 w-5 text-neon-red" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-100">{title}</h3>
            <p className="mt-2 text-sm text-gray-400 leading-relaxed">{message}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onCancel} className="neon-secondary">
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={danger ? "neon-danger" : "neon-primary"}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
