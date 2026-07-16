import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";

const PullOptionsModal = ({ isOpen, onClose, onManualEntry }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Pull Options"
      footer={<Button onClick={onManualEntry}>Manual Entry</Button>}
    >
      <p className="text-sm text-slate-600">
        Use the HMI for an automatic pull, or record the quantity manually.
      </p>
    </Modal>
  );
};

export default PullOptionsModal;
