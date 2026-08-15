import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppContent, Card, Button, Input, Select, Toast } from '@adminlte/react';

import SummaryTiles from '../components/SummaryTiles';
import DeviceTable from '../components/DeviceTable';
import DeviceFormDialog from '../components/DeviceFormDialog';
import DeleteConfirmDialog from '../components/DeleteConfirmDialog';
import DeviceHistoryDialog from '../components/DeviceHistoryDialog';
import FirewallHealthDialog from '../components/FirewallHealthDialog';
import SwitchHealthDialog from '../components/SwitchHealthDialog';
import { DEVICE_TYPES } from '../config/deviceTypeDefaults';
import {
  listDevices,
  getSummary,
  createDevice,
  updateDevice,
  deleteDevice,
  checkNow,
  listDeviceGroups,
} from '../api/devices';
import { setDeviceCredential } from '../api/deviceMonitoring';
import { useDeviceSocket } from '../hooks/useDeviceSocket';

export default function DashboardPage() {
  useDeviceSocket();
  const queryClient = useQueryClient();

  // The device-type filter is driven by the URL (sidebar link), not a dropdown.
  const { type } = useParams();
  const activeType = DEVICE_TYPES.find((t) => t.value === type);

  const [statusFilter, setStatusFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [deletingDevice, setDeletingDevice] = useState(null);
  const [historyDevice, setHistoryDevice] = useState(null);
  const [deviceHealthTarget, setDeviceHealthTarget] = useState(null);
  const [snackbar, setSnackbar] = useState('');

  const filters = useMemo(
    () => ({
      ...(type && { type }),
      ...(statusFilter && { status: statusFilter }),
      ...(groupFilter && { group: groupFilter }),
      ...(search && { q: search }),
    }),
    [type, statusFilter, groupFilter, search]
  );

  const devicesQuery = useQuery({
    queryKey: ['devices', filters],
    queryFn: () => listDevices(filters),
    refetchInterval: 15000, // fallback in case a socket event is missed
  });

  // Summary uses the same filters (minus search) so the tiles match whatever the table is scoped to.
  const summaryFilters = useMemo(
    () => ({ ...(type && { type }), ...(statusFilter && { status: statusFilter }), ...(groupFilter && { group: groupFilter }) }),
    [type, statusFilter, groupFilter]
  );
  const summaryQuery = useQuery({
    queryKey: ['summary', summaryFilters],
    queryFn: () => getSummary(summaryFilters),
    refetchInterval: 15000,
  });

  const groupsQuery = useQuery({ queryKey: ['device-groups'], queryFn: listDeviceGroups });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['devices'] });
    queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  const createMutation = useMutation({
    mutationFn: createDevice,
    onSuccess: () => {
      invalidate();
      setSnackbar('Device added');
    },
    onError: (err) => setSnackbar(err.response?.data?.error || 'Failed to add device'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => updateDevice(id, payload),
    onSuccess: () => {
      invalidate();
      setSnackbar('Device updated');
    },
    onError: (err) => setSnackbar(err.response?.data?.error || 'Failed to update device'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDevice,
    onSuccess: () => {
      invalidate();
      setSnackbar('Device removed');
    },
    onError: () => setSnackbar('Failed to remove device'),
  });

  const checkNowMutation = useMutation({
    mutationFn: checkNow,
    onSuccess: (data) => {
      invalidate();
      setSnackbar(`Checked ${data.device.name}: ${data.device.status.current}`);
    },
  });

  const handleOpenAdd = () => {
    setEditingDevice(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (device) => {
    setEditingDevice(device);
    setFormOpen(true);
  };

  const handleSubmitForm = (form, extra) => {
    const onDeviceSaved = async (device) => {
      try {
        if (extra?.connectorApiToken) {
          await setDeviceCredential(device._id, { type: 'api_token', apiToken: extra.connectorApiToken });
        } else if (extra?.sshUsername && extra?.sshPassword) {
          await setDeviceCredential(device._id, { type: 'username_password', username: extra.sshUsername, password: extra.sshPassword });
        }
      } catch (err) {
        setSnackbar('Device saved, but the credential failed to save: ' + (err.response?.data?.error || err.message));
      }
    };
    if (editingDevice) {
      updateMutation.mutate({ id: editingDevice._id, payload: form }, { onSuccess: onDeviceSaved });
    } else {
      createMutation.mutate(form, { onSuccess: onDeviceSaved });
    }
    setFormOpen(false);
  };

  const handleConfirmDelete = () => {
    deleteMutation.mutate(deletingDevice._id);
    setDeletingDevice(null);
  };

  return (
    <AppContent>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h1 className="h3 mb-0">{activeType ? activeType.navLabel : 'All Devices'}</h1>
          <p className="text-secondary mb-0">
            {activeType
              ? `Live status of monitored ${activeType.navLabel.toLowerCase()}`
              : 'Live status of all firewalls, switches, servers, applications, and cameras'}
          </p>
        </div>
        <Button theme="primary" icon="bi-plus-lg" label="Add device" onClick={handleOpenAdd} />
      </div>

      <div className="mb-3">
        <SummaryTiles summary={summaryQuery.data} />
      </div>

      <Card className="mb-3">
        <div className="row g-3 align-items-end">
          <div className="col-md-4">
            <Input
              name="search"
              label="Search"
              fgroupClass="mb-0"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or IP"
            />
          </div>
          <div className="col-md-3">
            <Select name="statusFilter" label="Status" fgroupClass="mb-0" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
              <option value="unknown">Unknown</option>
            </Select>
          </div>
          {groupsQuery.data?.length > 0 && (
            <div className="col-md-3">
              <Select name="groupFilter" label="Group" fgroupClass="mb-0" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                <option value="">All groups</option>
                {groupsQuery.data.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <DeviceTable
          devices={devicesQuery.data}
          onEdit={handleOpenEdit}
          onDelete={setDeletingDevice}
          onCheckNow={(d) => checkNowMutation.mutate(d._id)}
          onViewHistory={setHistoryDevice}
          onViewDeviceHealth={setDeviceHealthTarget}
        />
      </Card>

      <DeviceFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmitForm}
        initialValue={editingDevice}
      />

      <DeleteConfirmDialog
        open={Boolean(deletingDevice)}
        device={deletingDevice}
        onClose={() => setDeletingDevice(null)}
        onConfirm={handleConfirmDelete}
      />

      <DeviceHistoryDialog open={Boolean(historyDevice)} device={historyDevice} onClose={() => setHistoryDevice(null)} />

      <FirewallHealthDialog
        open={deviceHealthTarget?.type === 'firewall'}
        device={deviceHealthTarget?.type === 'firewall' ? deviceHealthTarget : null}
        onClose={() => setDeviceHealthTarget(null)}
      />

      <SwitchHealthDialog
        open={deviceHealthTarget?.type === 'switch'}
        device={deviceHealthTarget?.type === 'switch' ? deviceHealthTarget : null}
        onClose={() => setDeviceHealthTarget(null)}
      />

      <div className="toast-container position-fixed bottom-0 end-0 p-3" style={{ zIndex: 1090 }}>
        <Toast show={Boolean(snackbar)} onClose={() => setSnackbar('')}>
          {snackbar}
        </Toast>
      </div>
    </AppContent>
  );
}
