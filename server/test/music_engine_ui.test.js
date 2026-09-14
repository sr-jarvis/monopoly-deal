const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('WebAudio Ambient Music Synthesizer Engine & UI Contracts', function () {
  const clientSrcDir = path.join(__dirname, '../../client/src');
  const utilsDir = path.join(clientSrcDir, 'utils');
  const componentsDir = path.join(clientSrcDir, 'components');

  it('should verify musicEngine.ts utility file exists and defines track styles', function () {
    const musicEnginePath = path.join(utilsDir, 'musicEngine.ts');
    assert.strictEqual(fs.existsSync(musicEnginePath), true, 'musicEngine.ts file must exist');

    const content = fs.readFileSync(musicEnginePath, 'utf8');
    assert.ok(content.includes("export type TrackStyle = 'chill' | 'jazz' | 'ambient'"), 'musicEngine.ts must export TrackStyle');
    assert.ok(content.includes('CHORD_PROGRESSIONS'), 'musicEngine.ts must define procedural CHORD_PROGRESSIONS');
    assert.ok(content.includes('monopoly_deal_music_enabled'), 'musicEngine.ts must reference localStorage keys');
    assert.ok(content.includes('export const musicEngine = new WebAudioMusicEngine()'), 'musicEngine.ts must export singleton instance');
  });

  it('should verify MusicPlayerControls.tsx component exists with ARIA accessibility', function () {
    const componentPath = path.join(componentsDir, 'MusicPlayerControls.tsx');
    assert.strictEqual(fs.existsSync(componentPath), true, 'MusicPlayerControls.tsx file must exist');

    const content = fs.readFileSync(componentPath, 'utf8');
    assert.ok(content.includes('export const MusicPlayerControls'), 'Must export MusicPlayerControls component');
    assert.ok(content.includes('role="toolbar"'), 'Must define role="toolbar" attribute for accessibility');
    assert.ok(content.includes('aria-label="Background Music Controls"'), 'Must define aria-label attribute');
    assert.ok(content.includes('🎵 Music On'), 'Must render active music indicator text');
    assert.ok(content.includes('Smooth Chill'), 'Must render track style option text');
  });

  it('should verify MusicPlayerControls integration in LobbyView and GameBoardView', function () {
    const lobbyPath = path.join(componentsDir, 'LobbyView.tsx');
    const gameBoardPath = path.join(componentsDir, 'GameBoardView.tsx');

    const lobbyContent = fs.readFileSync(lobbyPath, 'utf8');
    assert.ok(lobbyContent.includes("import { MusicPlayerControls } from './MusicPlayerControls'"), 'LobbyView must import MusicPlayerControls');
    assert.ok(lobbyContent.includes('<MusicPlayerControls'), 'LobbyView must render MusicPlayerControls');

    const gameBoardContent = fs.readFileSync(gameBoardPath, 'utf8');
    assert.ok(gameBoardContent.includes("import { MusicPlayerControls } from './MusicPlayerControls'"), 'GameBoardView must import MusicPlayerControls');
    assert.ok(gameBoardContent.includes('<MusicPlayerControls compact />'), 'GameBoardView must render compact MusicPlayerControls');
  });
});
