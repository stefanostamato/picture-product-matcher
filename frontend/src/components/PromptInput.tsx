interface PromptInputProps {
  value: string;
  onChange: (next: string) => void;
}

export function PromptInput({ value, onChange }: PromptInputProps) {
  return (
    <label className="field">
      <span>Prompt (optional)</span>
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. modern leather sectional under $1500"
      />
    </label>
  );
}
