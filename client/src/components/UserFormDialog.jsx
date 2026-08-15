import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Button, Input, Select, Alert } from '@adminlte/react';
import { useBootstrapModal } from '../hooks/useBootstrapModal';
import { listGroups } from '../api/groups';
import GroupsInput from './GroupsInput';

const MODAL_ID = 'user-form-modal';

const EMPTY = { username: '', email: '', role: 'operator', groups: [], password: '' };

export default function UserFormDialog({ open, onClose, onSubmit, initialValue, error }) {
  const [form, setForm] = useState(EMPTY);
  const isEdit = Boolean(initialValue);

  useBootstrapModal(MODAL_ID, open, onClose);

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: listGroups, enabled: open });

  useEffect(() => {
    if (initialValue) {
      setForm({
        username: initialValue.username,
        email: initialValue.email || '',
        role: initialValue.role,
        groups: initialValue.groups || [],
        password: '',
      });
    } else {
      setForm(EMPTY);
    }
  }, [initialValue, open]);

  const canSubmit = isEdit ? true : form.username.trim() && form.password.length >= 8;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const payload = { email: form.email, role: form.role, groups: form.role === 'admin' ? [] : form.groups };
    if (!isEdit) {
      payload.username = form.username.trim();
      payload.password = form.password;
    } else if (form.password) {
      payload.password = form.password;
    }
    onSubmit(payload);
  };

  return (
    <Modal
      id={MODAL_ID}
      title={isEdit ? `Edit ${initialValue.username}` : 'Add user'}
      centered
      footer={
        <>
          <Button theme="secondary" outline label="Cancel" data-bs-dismiss="modal" />
          <Button theme="primary" label={isEdit ? 'Save changes' : 'Add user'} disabled={!canSubmit} onClick={handleSubmit} />
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Alert theme="danger">{error}</Alert>
        </div>
      )}
      {!isEdit && (
        <Input name="username" label="Username" required value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
      )}
      <Input name="email" label="Email (optional)" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      <Select name="role" label="Role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
        <option value="operator">Operator (manage devices)</option>
        <option value="admin">Admin (manage devices + users)</option>
      </Select>
      {form.role === 'operator' && (
        <GroupsInput
          value={form.groups}
          onChange={(groups) => setForm((f) => ({ ...f, groups }))}
          suggestions={(groupsQuery.data || []).map((g) => g.name)}
        />
      )}
      <Input
        name="password"
        label={isEdit ? 'New password (leave blank to keep current)' : 'Password'}
        type="password"
        required={!isEdit}
        value={form.password}
        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        hint="At least 8 characters"
      />
    </Modal>
  );
}
