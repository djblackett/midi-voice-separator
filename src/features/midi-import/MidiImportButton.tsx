interface MidiImportButtonProps {
  disabled: boolean;
  onImport: () => void;
}

export function MidiImportButton({ disabled, onImport }: MidiImportButtonProps) {
  return (
    <button type="button" className="primary-button" disabled={disabled} onClick={onImport}>
      Import MIDI
    </button>
  );
}
