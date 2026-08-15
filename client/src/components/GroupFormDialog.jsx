import { useEffect, useState } from 'react';
import { Modal, Button, Input, Alert } from '@adminlte/react';
import { useBootstrapModal } from '../hooks/useBootstrapModal';

const MODAL_ID = 'group-form-modal';

const EMPTY = { name: '', description: '' };

export default function GroupFormDialog({ open, onClose, onSubmit, initialValue, error }) {
  const [form, setForm] = useState(EMPTY);
  const isEdit = Boolean(initialValue);

  useBootstrapModal(MODAL_ID, open, onClose);

  useEffect(() => {
    if (initialValue) {
      setForm({ name: initialValue.name || '', description: initialValue.description || '' });
    } else {
      setForm(EMPTY);
    }
  }, [initialValue, open]);

  const canSubmit = form.name.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ name: form.name.trim(), description: form.description });
  };

  return (
    <Modal
      id={MODAL_ID}
      title={isEdit ? `Edit ${initialValue.name}` : 'Add group'}
      centered
      footer={
        <>
          <Button theme="secondary" outline label="Cancel" data-bs-dismiss="modal" />
          <Button theme="primary" label={isEdit ? 'Save changes' : 'Add group'} disabled={!canSubmit} onClick={handleSubmit} />
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Alert theme="danger">{error}</Alert>
        </div>
      )}
      <Input
        name="groupName"
        label="Name"
        required
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        hint={isEdit ? 'Renaming updates every device and user currently assigned to this group.' : undefined}
      />
      <Input
        name="groupDescription"
        label="Description (optional)"
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
      />
    </Modal>
  );
}
