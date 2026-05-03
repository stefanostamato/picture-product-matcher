interface ApiKeyInputProps {
  value: string;
  onChange: (next: string) => void;
}

export function ApiKeyInput({ value, onChange }: ApiKeyInputProps) {
  return (
    <label className="field">
      <span>API key</span>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="sk-..."
      />
    </label>
  );
}
