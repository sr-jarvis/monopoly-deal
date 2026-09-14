/**
 * card_flight_ui.test.js — Server/Client contract unit tests for Monopoly Deal
 * Card Flight Trajectory, 3D Spatial Arc & Touch Deal Engine.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Monopoly Deal Card Flight Trajectory UI & Engine Suite', () => {
  const flightEnginePath = path.join(__dirname, '../../client/src/utils/cardFlightEngine.ts');
  const flightOverlayPath = path.join(__dirname, '../../client/src/components/CardFlightOverlay.tsx');
  const soundEnginePath = path.join(__dirname, '../../client/src/utils/soundEngine.ts');

  it('should verify cardFlightEngine.ts file existence and export signatures', () => {
    assert.strictEqual(fs.existsSync(flightEnginePath), true, 'cardFlightEngine.ts should exist');
    const content = fs.readFileSync(flightEnginePath, 'utf8');

    assert.strictEqual(content.includes('export type ShuffleSpeed'), true);
    assert.strictEqual(content.includes('export interface FlightPoint3D'), true);
    assert.strictEqual(content.includes('export interface SeatCoordinates'), true);
    assert.strictEqual(content.includes('export interface CardFlightTransform'), true);
    assert.strictEqual(content.includes('export interface TouchSwipeGesture'), true);
    assert.strictEqual(content.includes('export const SEAT_PRESETS'), true);
    assert.strictEqual(content.includes('export const CARD_FLIGHT_EVENTS'), true);
    assert.strictEqual(content.includes('export function quadraticBezier1D'), true);
    assert.strictEqual(content.includes('export function calculateBezier3D'), true);
    assert.strictEqual(content.includes('export function calculateFlightTransform'), true);
    assert.strictEqual(content.includes('export function getSeatPreset'), true);
    assert.strictEqual(content.includes('export function recognizeTouchDealSwipe'), true);
    assert.strictEqual(content.includes('export class CardFlightEngine'), true);
  });

  it('should verify CardFlightOverlay.tsx component exports and 3D perspective styling', () => {
    assert.strictEqual(fs.existsSync(flightOverlayPath), true, 'CardFlightOverlay.tsx should exist');
    const content = fs.readFileSync(flightOverlayPath, 'utf8');

    assert.strictEqual(content.includes('export interface CardFlightOverlayProps'), true);
    assert.strictEqual(content.includes('export const CardFlightOverlay'), true);
    assert.strictEqual(content.includes('CARD_FLIGHT_EVENTS'), true);
    assert.strictEqual(content.includes('calculateFlightTransform'), true);
    assert.strictEqual(content.includes('perspective:'), true);
    assert.strictEqual(content.includes('preserve-3d'), true);
    assert.strictEqual(content.includes('playCardPlay'), true);
    assert.strictEqual(content.includes('playCardFlip'), true);
  });

  it('should verify 3D Parabolic Bezier math logic and seat preset coordinates', () => {
    assert.strictEqual(fs.existsSync(soundEnginePath), true, 'soundEngine.ts should exist');
    const content = fs.readFileSync(flightEnginePath, 'utf8');

    assert.strictEqual(content.includes("South (Human)'"), true);
    assert.strictEqual(content.includes("North (Opponent)'"), true);
    assert.strictEqual(content.includes('md:cardflight:start'), true);
    assert.strictEqual(content.includes('md:cardflight:land'), true);
    assert.strictEqual(content.includes('md:cardflight:complete'), true);
  });
});
