import { useState } from 'react';
import { Badge, Button } from '@adminlte/react';

// Restricted groups are picked from the registry (not freeform-typed) so an
// admin can't accidentally create a near-duplicate group via a typo — new
// groups are created on the dedicated Groups page instead.
export default function GroupsInput({ value, onChange, suggestions = [] }) {
  const [pending, setPending] = useState('');
  const available = suggestions.filter((s) => !value.includes(s));

  const addGroup = () => {
    if (!pending) return;
    onChange([...value, pending]);
    setPending('');
  };

  const removeGroup = (g) => onChange(value.filter((v) => v !== g));

  return (
    <div className="mb-3">
      <label className="form-label">Restrict to groups (optional)</label>
      {value.length > 0 && (
        <div className="d-flex flex-wrap gap-1 mb-2">
          {value.map((g) => (
            <Badge key={g} theme="secondary">
              {g}
              <button
                type="button"
                className="btn-close btn-close-white ms-2"
                style={{ fontSize: '0.55rem' }}
                aria-label={`Remove ${g}`}
                onClick={() => removeGroup(g)}
              />
            </Badge>
          ))}
        </div>
      )}
      <div className="d-flex gap-2">
        <select className="form-select" value={pending} onChange={(e) => setPending(e.target.value)}>
          <option value="">{available.length ? 'Select a group…' : 'No more groups to add'}</option>
          {available.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <Button theme="secondary" outline label="Add" disabled={!pending} onClick={addGroup} />
      </div>
      <small className="form-text text-muted">
        Leave empty to see every device, regardless of group. Need a new group? Create it on the <a href="/groups">Groups</a> page
        first.
      </small>
    </div>
  );
}
