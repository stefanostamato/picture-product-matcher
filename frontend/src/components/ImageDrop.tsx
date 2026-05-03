interface ImageDropProps {
  file: File | null;
  onFile: (file: File | null) => void;
}

export function ImageDrop({ file, onFile }: ImageDropProps) {
  return (
    <label className="field">
      <span>Image</span>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {file ? <small className="hint">{file.name}</small> : null}
    </label>
  );
}
