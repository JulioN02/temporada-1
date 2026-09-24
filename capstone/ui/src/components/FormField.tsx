import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

/**
 * Label + control + localized field-level error wrapper (R-I18N-4: 422
 * field errors map per field). `htmlFor` pairs the label with the child
 * control id.
 */
export function FormField({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  /** string | null (ErrorState convention) — widened with undefined for the form-validation helpers. */
  error?: string | null | undefined
  children: ReactNode
}) {
  return (
    <div className="form-field">
      <label htmlFor={htmlFor} className="form-label">
        {label}
      </label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={props.className ? `input ${props.className}` : 'input'} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={props.className ? `select ${props.className}` : 'select'} />
}