import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findPotdFlairId } from '../lib/redditSubmit.mjs';

describe('findPotdFlairId', () => {
  it('matches POTD flair case-insensitively', () => {
    assert.equal(findPotdFlairId([{ id: 'b', text: 'POTD' }]), 'b');
  });

  it('returns null when missing', () => {
    assert.equal(findPotdFlairId([{ id: 'a', text: 'News' }]), null);
  });
});
