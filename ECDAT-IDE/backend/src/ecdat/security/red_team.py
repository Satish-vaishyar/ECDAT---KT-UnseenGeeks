"""
Adversarial Red Team Attack Generator & PPO Adaptive Agent (Model 29 Red Team)
"""

import os
import torch
import numpy as np
from stable_baselines3 import PPO

class AdversarialAttackGenerator:
    """Generates mathematical gradient & heuristic perturbations (FGSM, PGD, random noise)."""
    def __init__(self, epsilon=0.03, alpha=0.007, num_steps=10):
        self.epsilon = epsilon
        self.alpha = alpha
        self.num_steps = num_steps

    def generate_fgsm(self, x, gradient):
        """Fast Gradient Sign Method: x + eps * sign(grad)"""
        return x + self.epsilon * np.sign(gradient)

    def generate_pgd(self, x, gradient_fn, steps=None):
        """Projected Gradient Descent across iterative bounded hypersphere."""
        steps = steps or self.num_steps
        x_adv = x.copy()
        for _ in range(steps):
            grad = gradient_fn(x_adv)
            x_adv = x_adv + self.alpha * np.sign(grad)
            # Clip perturbation within epsilon ball
            eta = np.clip(x_adv - x, -self.epsilon, self.epsilon)
            x_adv = x + eta
        return x_adv

class PPORedTeamAgent:
    """Wrapper for the Proximal Policy Optimization (PPO) Adaptive Adversarial Agent."""
    def __init__(self, model_path=None, device='cpu'):
        self.agent = None
        if model_path and os.path.exists(model_path):
            self.agent = PPO.load(model_path, device=device)

    def attack_sample(self, sample, max_steps=10, step_size=0.05, target_detector=None):
        """
        Applies sequential adaptive perturbations.
        Returns: (perturbed_sample, evaded, steps_taken)
        """
        cur = sample.copy()
        for step in range(1, max_steps + 1):
            if self.agent:
                action, _ = self.agent.predict(cur, deterministic=True)
                cur += action * step_size
            else:
                cur += np.random.uniform(-step_size, step_size, size=cur.shape)
            
            if target_detector:
                with torch.no_grad():
                    prob = target_detector.predict_proba(torch.FloatTensor(cur).unsqueeze(0)).item()
                    if prob < 0.5: # Evasion succeeded
                        return cur, True, step
        return cur, False, max_steps
