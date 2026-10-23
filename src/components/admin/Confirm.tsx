"use client";

/** 送出前確認（刪除等不可逆動作）；formAction 可指定與外層表單不同的 Server Action */
export function ConfirmButton({
  message,
  children,
  className = "adm-btn danger",
  name,
  value,
  formAction,
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
  name?: string;
  value?: string;
  formAction?: (fd: FormData) => void | Promise<void>;
}) {
  return (
    <button
      type="submit"
      className={className}
      name={name}
      value={value}
      formAction={formAction}
      formNoValidate
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
