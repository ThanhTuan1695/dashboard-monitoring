import { Modal, Button } from '@adminlte/react';
import { useBootstrapModal } from '../hooks/useBootstrapModal';

const MODAL_ID = 'delete-device-modal';

export default function DeleteConfirmDialog({ open, device, onClose, onConfirm }) {
  useBootstrapModal(MODAL_ID, open, onClose);

  return (
    <Modal
      id={MODAL_ID}
      title="Remove device?"
      centered
      footer={
        <>
          <Button theme="secondary" outline label="Cancel" data-bs-dismiss="modal" />
          <Button theme="danger" label="Remove" data-bs-dismiss="modal" onClick={onConfirm} />
        </>
      }
    >
      <p className="mb-0">
        This will stop monitoring <strong>{device?.name}</strong> ({device?.ipAddress}) and delete it from the inventory.
        This can't be undone.
      </p>
    </Modal>
  );
}
