import { SmallBox } from '@adminlte/react';

const TILES = [
  { key: 'total', label: 'Total devices', theme: 'info', icon: 'bi-hdd-stack' },
  { key: 'up', label: 'Up', theme: 'success', icon: 'bi-check-circle' },
  { key: 'down', label: 'Down', theme: 'danger', icon: 'bi-x-circle' },
  { key: 'unknown', label: 'Unknown', theme: 'secondary', icon: 'bi-question-circle' },
];

export default function SummaryTiles({ summary }) {
  return (
    <div className="row">
      {TILES.map(({ key, label, theme, icon }) => (
        <div className="col-lg-3 col-6" key={key}>
          <SmallBox title={summary?.[key] ?? '—'} text={label} theme={theme} icon={<i className={`bi ${icon} small-box-icon`}></i>} />
        </div>
      ))}
    </div>
  );
}
