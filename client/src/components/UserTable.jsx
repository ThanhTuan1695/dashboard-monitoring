import { Table, Badge, Button, Tooltip } from '@adminlte/react';

export default function UserTable({ users, currentUserId, onEdit, onDelete }) {
  const columns = [
    { key: 'username', header: 'Username' },
    { key: 'email', header: 'Email', render: (u) => u.email || '—' },
    { key: 'role', header: 'Role', render: (u) => <Badge theme={u.role === 'admin' ? 'primary' : 'secondary'}>{u.role}</Badge> },
    {
      key: 'groups',
      header: 'Groups',
      render: (u) =>
        u.groups?.length ? (
          <div className="d-flex gap-1 flex-wrap">
            {u.groups.map((g) => (
              <Badge key={g} theme="secondary">
                {g}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-secondary">All (unrestricted)</span>
        ),
    },
    { key: 'lastLoginAt', header: 'Last login', render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never') },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      render: (u) => {
        const isSelf = u._id === currentUserId;
        return (
          <div className="d-flex gap-1 justify-content-end">
            <Tooltip title="Edit">
              <Button theme="secondary" outline size="sm" icon="bi-pencil" aria-label="Edit" onClick={() => onEdit(u)} />
            </Tooltip>
            <Tooltip title={isSelf ? "You can't delete your own account" : 'Remove'}>
              <Button
                theme="danger"
                outline
                size="sm"
                icon="bi-trash"
                aria-label="Remove"
                disabled={isSelf}
                onClick={() => onDelete(u)}
              />
            </Tooltip>
          </div>
        );
      },
    },
  ];

  return <Table columns={columns} data={users || []} rowKey={(u) => u._id} hover small responsive emptyMessage="No users yet." />;
}
