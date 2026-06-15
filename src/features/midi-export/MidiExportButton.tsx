interface MidiExportButtonProps {
  disabled: boolean;
  onExport: () => void;
}

export function MidiExportButton({ disabled, onExport }: MidiExportButtonProps) {
  return (
    <button type="button" className="secondary-button" disabled={disabled} onClick={onExport}>
      Export MIDI
    </button>
  );
}
