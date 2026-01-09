/**
 * Crash Recovery Module
 * Handles restoration of state after unexpected shutdowns
 */

import { logger } from '../utils';
import { sessionRecoveryManager } from './session-manager';
import { gitManagerAgent } from '../agents/git-manager';

export class CrashRecovery {
  /**
   * Attempt to recover previous session
   */
  async recover(): Promise<boolean> {
    logger.info('Checking for crash recovery...', 'CrashRecovery');

    const { needed, session, reason } =
      await sessionRecoveryManager.checkRecoveryNeeded();

    if (needed && session) {
      logger.warn(`Crash detected: ${reason}`, 'CrashRecovery');

      // Try to pop any stashed changes from previous session
      try {
        await gitManagerAgent.popStash();
        logger.info('Restored stashed changes', 'CrashRecovery');
      } catch (error) {
        logger.debug('No stash to pop or git not available', 'CrashRecovery', {
          error,
        });
      }

      // Logic to replay or alert user
      await sessionRecoveryManager.restoreSession(session);
      return true;
    }

    return false;
  }
}

export const crashRecovery = new CrashRecovery();
