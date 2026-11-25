import React from "react";

/**
 * Optional button wrapper for clearer Hourmaker discovery metadata.
 * Plain HTML buttons are also discovered automatically; use this component
 * when you want to supply a stable ID, category, or helpful description.
 */
export default function AIActionButton({
  actionId,
  description,
  category = "ui-action",
  risk,
  confirm = false,
  children,
  ...buttonProps
}) {
  return (
    <button
      {...buttonProps}
      data-ai-action-id={actionId || undefined}
      data-ai-description={description || undefined}
      data-ai-category={category}
      data-ai-risk={risk || undefined}
      data-ai-confirm={confirm ? "true" : undefined}
    >
      {children}
    </button>
  );
}
