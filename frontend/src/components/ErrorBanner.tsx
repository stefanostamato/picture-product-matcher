interface ErrorBannerProps {
  code: string;
  message: string;
  upstreamStatus?: number;
  upstreamCode?: string;
}

export function ErrorBanner({
  code,
  message,
  upstreamStatus,
  upstreamCode,
}: ErrorBannerProps) {
  const upstreamBits: string[] = [];
  if (upstreamStatus !== undefined) upstreamBits.push(`HTTP ${upstreamStatus}`);
  if (upstreamCode) upstreamBits.push(upstreamCode);
  const upstream = upstreamBits.length > 0 ? upstreamBits.join(" · ") : null;

  return (
    <div className="banner banner-error" role="alert">
      <strong>{code}</strong>
      <span>{message}</span>
      {upstream ? <small>upstream: {upstream}</small> : null}
    </div>
  );
}
