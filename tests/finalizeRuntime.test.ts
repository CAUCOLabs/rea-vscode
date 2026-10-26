import { describe, expect, it, vi } from 'vitest';
import { finalizeRuntime } from '../scripts/finalize-runtime.mjs';

describe('runtime finalization routing', () => {
  const options = {
    projectRoot: '/test/project',
    stagedRuntime: '/test/project/.runtime-build-test/runtime',
    target: 'darwin-arm64'
  };

  it('saves a candidate without publishing in prepare-only mode', async () => {
    const saveCandidate = vi.fn().mockResolvedValue({
      saved: true,
      candidatePath: '/test/project/.runtime-candidates/test'
    });

    const publish = vi.fn();

    const result = await finalizeRuntime({
      ...options,
      prepareOnly: true,
      saveCandidate,
      publish
    });

    expect(saveCandidate).toHaveBeenCalledExactlyOnceWith(options);
    expect(publish).not.toHaveBeenCalled();
    expect(result.mode).toBe('candidate');
    expect(result.saved).toBe(true);
  });

  it('publishes normally when prepare-only mode is disabled', async () => {
    const saveCandidate = vi.fn();
    const publish = vi.fn().mockResolvedValue({
      published: true,
      cleanupPending: false
    });

    const result = await finalizeRuntime({
      ...options,
      prepareOnly: false,
      saveCandidate,
      publish
    });

    expect(saveCandidate).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      projectRoot: options.projectRoot,
      stagedRuntime: options.stagedRuntime,
      target: options.target,
      preservePreviousRuntime: false
    });
    expect(result.mode).toBe('published');
    expect(result.published).toBe(true);
  });

  it('does not publish if candidate preservation fails', async () => {
    const saveCandidate = vi.fn().mockRejectedValue(
      new Error('Candidate validation failed')
    );

    const publish = vi.fn();

    await expect(
      finalizeRuntime({
        ...options,
        prepareOnly: true,
        saveCandidate,
        publish
      })
    ).rejects.toThrow('Candidate validation failed');

    expect(saveCandidate).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it('forwards previous-runtime preservation to the publisher', async () => {
    const saveCandidate = vi.fn();
    const publish = vi.fn().mockResolvedValue({
      published: true,
      previousRuntimePreserved: true,
      backup: '/test/project/.runtime-previous-active'
    });

    const result = await finalizeRuntime({
      ...options,
      prepareOnly: false,
      preservePreviousRuntime: true,
      saveCandidate,
      publish
    });

    expect(saveCandidate).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      projectRoot: options.projectRoot,
      stagedRuntime: options.stagedRuntime,
      target: options.target,
      preservePreviousRuntime: true
    });

    expect(result.previousRuntimePreserved).toBe(true);
    expect(result.mode).toBe('published');
  });
});
