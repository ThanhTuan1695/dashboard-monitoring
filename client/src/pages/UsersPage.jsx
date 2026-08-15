import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppContent, Card, Button, Modal, Toast } from '@adminlte/react';

import UserTable from '../components/UserTable';
import UserFormDialog from '../components/UserFormDialog';
import { useBootstrapModal } from '../hooks/useBootstrapModal';
import { listUsers, createUser, updateUser, deleteUser } from '../api/users';
import { useAuth } from '../context/AuthContext';

const DELETE_MODAL_ID = 'delete-user-modal';

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [formError, setFormError] = useState('');
  const [snackbar, setSnackbar] = useState('');

  useBootstrapModal(DELETE_MODAL_ID, Boolean(deletingUser), () => setDeletingUser(null));

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setSnackbar('User added');
    },
    onError: (err) => setFormError(err.response?.data?.error || 'Failed to add user'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateUser(id, payload),
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      setSnackbar('User updated');
    },
    onError: (err) => setFormError(err.response?.data?.error || 'Failed to update user'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      invalidate();
      setSnackbar('User removed');
    },
    onError: (err) => setSnackbar(err.response?.data?.error || 'Failed to remove user'),
  });

  const handleOpenAdd = () => {
    setEditingUser(null);
    setFormError('');
    setFormOpen(true);
  };

  const handleOpenEdit = (u) => {
    setEditingUser(u);
    setFormError('');
    setFormOpen(true);
  };

  const handleSubmit = (payload) => {
    if (editingUser) {
      updateMutation.mutate({ id: editingUser._id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <AppContent>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Users</h1>
        <Button theme="primary" icon="bi-plus-lg" label="Add user" onClick={handleOpenAdd} />
      </div>

      <Card>
        <UserTable users={usersQuery.data} currentUserId={currentUser?.id} onEdit={handleOpenEdit} onDelete={setDeletingUser} />
      </Card>

      <UserFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} initialValue={editingUser} error={formError} />

      <Modal
        id={DELETE_MODAL_ID}
        title="Remove user?"
        centered
        footer={
          <>
            <Button theme="secondary" outline label="Cancel" data-bs-dismiss="modal" />
            <Button
              theme="danger"
              label="Remove"
              data-bs-dismiss="modal"
              onClick={() => {
                deleteMutation.mutate(deletingUser._id);
                setDeletingUser(null);
              }}
            />
          </>
        }
      >
        <p className="mb-0">
          This will permanently remove <strong>{deletingUser?.username}</strong>'s access. This can't be undone.
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
