interface ErrorBannerProps {
  code: string;
  message: string;
}

export function ErrorBanner({ code, message }: ErrorBannerProps) {
  return (
    <div className="banner banner-error" role="alert">
      <strong>{code}</strong>
      <span>{message}</span>
    </div>
  );
}
