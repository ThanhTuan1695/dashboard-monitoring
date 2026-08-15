import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppContent, Card, Table, Badge, Button, Modal, Toast } from '@adminlte/react';
import GroupFormDialog from '../components/GroupFormDialog';
import { useBootstrapModal } from '../hooks/useBootstrapModal';
import { listGroups, createGroup, updateGroup, deleteGroup } from '../api/groups';

const DELETE_MODAL_ID = 'delete-group-modal';

export default function GroupsPage() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [deletingGroup, setDeletingGroup] = useState(null);
  const [formError, setFormError] = useState('');
  const [snackbar, setSnackbar] = useState('');

  useBootstrapModal(DELETE_MODAL_ID, Boolean(deletingGroup), () => setDeletingGroup(null));

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: listGroups });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['groups'] });
    queryClient.invalidateQueries({ queryKey: ['device-groups'] });
    queryClient.invalidateQueries({ queryKey: ['devices'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const createMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setSnackbar('Group added');
    },
    onError: (err) => setFormError(err.response?.data?.error || 'Failed to add group'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateGroup(id, payload),
    onSuccess: (data) => {
      invalidate();
      setFormOpen(false);
      setSnackbar(data.cascade ? `Group renamed — updated ${data.cascade.devices} device(s), ${data.cascade.users} user(s)` : 'Group updated');
    },
    onError: (err) => setFormError(err.response?.data?.error || 'Failed to update group'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteGroup,
    onSuccess: (data) => {
      invalidate();
      setSnackbar(`Group removed — unassigned from ${data.devicesUnassigned} device(s), ${data.usersUnassigned} user(s)`);
    },
    onError: (err) => setSnackbar(err.response?.data?.error || 'Failed to remove group'),
  });

  const handleOpenAdd = () => {
    setEditingGroup(null);
    setFormError('');
    setFormOpen(true);
  };

  const handleOpenEdit = (g) => {
    setEditingGroup(g);
    setFormError('');
    setFormOpen(true);
  };

  const handleSubmit = (payload) => {
    if (editingGroup) {
      updateMutation.mutate({ id: editingGroup._id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'description', header: 'Description', render: (g) => g.description || '—' },
    { key: 'deviceCount', header: 'Devices', render: (g) => <Badge theme="secondary">{g.deviceCount}</Badge> },
    { key: 'userCount', header: 'Users', render: (g) => <Badge theme="secondary">{g.userCount}</Badge> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      render: (g) => (
        <div className="d-flex gap-1 justify-content-end">
          <Button theme="secondary" outline size="sm" icon="bi-pencil" aria-label="Edit" onClick={() => handleOpenEdit(g)} />
          <Button theme="danger" outline size="sm" icon="bi-trash" aria-label="Remove" onClick={() => setDeletingGroup(g)} />
        </div>
      ),
    },
  ];

  return (
    <AppContent>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h1 className="h3 mb-0">Groups</h1>
          <p className="text-secondary mb-0">Manage the groups used to restrict operator visibility and organize devices.</p>
        </div>
        <Button theme="primary" icon="bi-plus-lg" label="Add group" onClick={handleOpenAdd} />
      </div>

      <Card>
        <Table
          columns={columns}
          data={groupsQuery.data || []}
          rowKey={(g) => g._id}
          hover
          small
          responsive
          emptyMessage="No groups yet — add one, or assign a group to a device/user and it'll show up here."
        />
      </Card>

      <GroupFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} initialValue={editingGroup} error={formError} />

      <Modal
        id={DELETE_MODAL_ID}
        title="Remove group?"
        centered
        footer={
          <>
            <Button theme="secondary" outline label="Cancel" data-bs-dismiss="modal" />
            <Button
              theme="danger"
              label="Remove"
              data-bs-dismiss="modal"
              onClick={() => {
                deleteMutation.mutate(deletingGroup._id);
                setDeletingGroup(null);
              }}
            />
          </>
        }
      >
        <p className="mb-0">
          This will unassign <strong>{deletingGroup?.name}</strong> from {deletingGroup?.deviceCount} device(s) and remove it from{' '}
          {deletingGroup?.userCount} user(s)' restricted groups. The devices and users themselves are not affected — only this group
          label. This can't be undone.
        </p>
      </Modal>

      <div className="toast-container position-fixed bottom-0 end-0 p-3" style={{ zIndex: 1090 }}>
        <Toast show={Boolean(snackbar)} onClose={() => setSnackbar('')}>
          {snackbar}
        </Toast>
      </div>
    </AppContent>
  );
}
