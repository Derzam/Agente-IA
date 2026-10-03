import { describe, it, expect } from 'vitest';
import { getAvailableOrderActions } from '../adapters/orderAdapter';

describe('Order Lifecycle Matrix Suite', () => {
  it('confirmed -> accepts "accept" transition', () => {
    const actions = getAvailableOrderActions('confirmed', 'delivery', 'operator');
    expect(actions.canAccept).toBe(true);
    expect(actions.validActions).toContain('accept');
    expect(actions.canStartPreparation).toBe(false);
    expect(actions.canMarkReady).toBe(false);
    expect(actions.canDispatch).toBe(false);
    expect(actions.canComplete).toBe(false);
  });

  it('accepted -> accepts "start_preparation" transition', () => {
    const actions = getAvailableOrderActions('accepted', 'delivery', 'operator');
    expect(actions.canStartPreparation).toBe(true);
    expect(actions.validActions).toContain('start_preparation');
    expect(actions.canAccept).toBe(false);
    expect(actions.canMarkReady).toBe(false);
  });

  it('preparing -> accepts "mark_ready" transition', () => {
    const actions = getAvailableOrderActions('preparing', 'delivery', 'operator');
    expect(actions.canMarkReady).toBe(true);
    expect(actions.validActions).toContain('mark_ready');
    expect(actions.canDispatch).toBe(false);
    expect(actions.canComplete).toBe(false);
  });

  it('ready delivery -> accepts "dispatch" transition', () => {
    const actions = getAvailableOrderActions('ready', 'delivery', 'operator');
    expect(actions.canDispatch).toBe(true);
    expect(actions.validActions).toContain('dispatch');
    expect(actions.canComplete).toBe(false); // cannot directly complete delivery order while in store
  });

  it('ready pickup -> accepts "complete" transition directly without dispatch', () => {
    const actions = getAvailableOrderActions('ready', 'pickup', 'operator');
    expect(actions.canComplete).toBe(true);
    expect(actions.validActions).toContain('complete');
    expect(actions.canDispatch).toBe(false); // pickup has no dispatch stage
  });

  it('out_for_delivery -> accepts "complete" transition', () => {
    const actions = getAvailableOrderActions('out_for_delivery', 'delivery', 'operator');
    expect(actions.canComplete).toBe(true);
    expect(actions.validActions).toContain('complete');
    expect(actions.canDispatch).toBe(false);
    expect(actions.canAccept).toBe(false);
  });

  it('delivered -> is a terminal state, no advancing transitions allowed', () => {
    const actions = getAvailableOrderActions('delivered', 'delivery', 'operator');
    expect(actions.validActions).toHaveLength(0);
    expect(actions.canCancel).toBe(false);
  });

  it('cancelled -> is a terminal state, no transitions allowed', () => {
    const actions = getAvailableOrderActions('cancelled', 'delivery', 'owner');
    expect(actions.validActions).toHaveLength(0);
    expect(actions.canCancel).toBe(false);
  });

  it('cancel permission: operator can only cancel confirmed or awaiting_confirmation orders', () => {
    const operatorConfirmed = getAvailableOrderActions('confirmed', 'delivery', 'operator');
    expect(operatorConfirmed.canCancel).toBe(true);

    const operatorInKitchen = getAvailableOrderActions('preparing', 'delivery', 'operator');
    expect(operatorInKitchen.canCancel).toBe(false);

    const managerInKitchen = getAvailableOrderActions('preparing', 'delivery', 'manager');
    expect(managerInKitchen.canCancel).toBe(true);

    const ownerInKitchen = getAvailableOrderActions('preparing', 'delivery', 'owner');
    expect(ownerInKitchen.canCancel).toBe(true);
  });
});
