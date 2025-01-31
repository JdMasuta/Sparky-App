import React from "react";
import Modal from "../shared/Modal";

const PullOptionsModal = ({ isOpen, onClose, onManualEntry }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pull Options">
      <div className="flex flex-col gap-4 p-6">
        <p className="text-gray-700 text-base">
          Use HMI for automatic pull or:
        </p>
        <button
          onClick={onManualEntry}
          className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-6 py-3 rounded shadow-md transition duration-200"
        >
          Manual Entry
        </button>
      </div>
    </Modal>
  );
};

export default PullOptionsModal;
