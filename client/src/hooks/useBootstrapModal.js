import { useEffect, useRef } from 'react';
import { Modal as BsModal } from 'bootstrap';

/**
 * @adminlte/react's <Modal> renders only markup — visibility is driven by
 * Bootstrap's JS Modal instance, not a React prop. This hook wires that up:
 * imperatively show()/hide() the instance when `open` changes, and call
 * `onHidden` when the modal closes for any reason (Esc, backdrop click, the
 * built-in close button) so the caller's state stays in sync.
 */
export function useBootstrapModal(elementId, open, onHidden) {
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const el = document.getElementById(elementId);
    if (!el) return undefined;

    const instance = BsModal.getOrCreateInstance(el);
    const handleHidden = () => {
      wasOpenRef.current = false;
      onHidden?.();
    };
    el.addEventListener('hidden.bs.modal', handleHidden);

    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true;
      instance.show();
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      instance.hide();
    }

    return () => el.removeEventListener('hidden.bs.modal', handleHidden);
  }, [elementId, open, onHidden]);
}
