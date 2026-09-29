"""
Proper Hybrid Quantum Detector (Model 29 Blue Team)
Combines classical non-linear feature compression with a 4-qubit Variational Quantum Circuit (VQC) in PennyLane.
"""

import os
import torch
import torch.nn as nn
import numpy as np
import pennylane as qml

N_QUBITS = 4
weight_shapes = {"weights": (2, N_QUBITS, 3)}

# Construct PennyLane QNode device
dev = qml.device('default.qubit', wires=N_QUBITS)

@qml.qnode(dev, interface='torch', diff_method='backprop')
def quantum_vqc(inputs, weights):
    """
    inputs: angles in [-pi, pi] for each of the 4 qubits
    weights: (2, 4, 3) variational parameters for strongly entangling layers
    """
    qml.AngleEmbedding(inputs, wires=range(N_QUBITS))
    qml.StronglyEntanglingLayers(weights, wires=range(N_QUBITS))
    return [qml.expval(qml.PauliZ(i)) for i in range(N_QUBITS)]

class ProperHybridQuantumDetector(nn.Module):
    """
    Enterprise-grade Hybrid Quantum Detector:
    1. Input feature standardization & 2-stage non-linear compression to 4 angles
    2. Bounded rotation mapping via Tanh() * pi across the entire Bloch sphere
    3. 4-Qubit Variational Quantum Circuit with entangling CNOT ladders
    4. Post-measurement classification head outputting raw logits
    """
    def __init__(self, input_dim=147, n_qubits=4):
        super().__init__()
        self.n_qubits = n_qubits
        self.pre_net = nn.Sequential(
            nn.BatchNorm1d(input_dim),
            nn.Linear(input_dim, 32),
            nn.LeakyReLU(0.2),
            nn.BatchNorm1d(32),
            nn.Linear(32, n_qubits),
            nn.Tanh()  # Bounds output to [-1, 1]
        )
        self.qlayer = qml.qnn.TorchLayer(quantum_vqc, weight_shapes)
        self.post_net = nn.Sequential(
            nn.Linear(n_qubits, 16),
            nn.LeakyReLU(0.2),
            nn.Linear(16, 1)
        )

    def forward(self, x):
        # 1. Classical compression and angle scaling to [-pi, pi]
        angles = self.pre_net(x) * np.pi
        # 2. Quantum Hilbert space projection
        q_out = self.qlayer(angles)
        # 3. Output logit
        logits = self.post_net(q_out)
        return logits

    def predict_proba(self, x):
        """Returns binary probability of adversarial perturbation [0, 1]"""
        with torch.no_grad():
            logits = self.forward(x)
            return torch.sigmoid(logits)

def create_quantum_detector(weights_path=None, input_dim=147, device='cpu'):
    """Factory function to instantiate and load trained weights."""
    model = ProperHybridQuantumDetector(input_dim=input_dim)
    if weights_path and os.path.exists(weights_path):
        state = torch.load(weights_path, map_location=device)
        model.load_state_dict(state)
    model.to(device)
    model.eval()
    return model
