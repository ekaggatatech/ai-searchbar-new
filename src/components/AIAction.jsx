import { useEffect } from "react";
import { registerFrontendAction } from "../config/actionsCatalog";

/**
 * AIAction Component
 * 
 * Drop-in enhanced button for Hourmaker frontend.
 * Automatically registers the button with the AI Search Bar and handles
 * intelligent navigation, visual targeting, and action execution.
 * 
 * @param {string} id - Unique action ID (e.g. 'export-team-data')
 * @param {string} name - Human readable name for the action
 * @param {string} description - Description used by AI and search
 * @param {string} path - Target path and section query (e.g. '/team?section=edit')
 * @param {string} category - Category (e.g. 'reporting', 'employee-management')
 * @param {string} risk - 'low' | 'normal' | 'confirm' | 'high'
 * @param {function} onClick - Click handler
 * @param {function} onExecute - Alias for onClick
 */
export default function AIAction({
  id,
  name,
  label,
  description,
  path,
  category = "ui-action",
  risk = "low",
  sensitive = false,
  className = "primary-button",
  title,
  disabled = false,
  type = "button",
  onClick,
  onExecute,
  children,
  ...restProps
}) {
  const actionLabel = label || name || (typeof children === "string" ? children : id);
  const actionDescription = description || actionLabel;

  // Auto-register action with frontend catalog so search bar knows about it immediately
  useEffect(() => {
    if (id) {
      registerFrontendAction({
        id,
        name: actionLabel,
        label: actionLabel,
        description: actionDescription,
        path: path || (typeof window !== "undefined" ? window.location.pathname + window.location.search : ""),
        category,
        risk,
        sensitive,
      });
    }
  }, [id, actionLabel, actionDescription, path, category, risk, sensitive]);

  const handleClick = (event) => {
    if (typeof onClick === "function") {
      onClick(event);
    } else if (typeof onExecute === "function") {
      onExecute(event);
    }
  };

  return (
    <button
      type={type}
      className={className}
      disabled={disabled}
      title={title || actionDescription}
      data-ai-action-id={id}
      data-ai-description={actionDescription}
      data-ai-category={category}
      data-ai-risk={risk}
      data-ai-path={path}
      data-ai-sensitive={sensitive ? "true" : undefined}
      onClick={handleClick}
      {...restProps}
    >
      {children || actionLabel}
    </button>
  );
}
