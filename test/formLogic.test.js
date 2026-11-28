import { describe, it, expect } from 'vitest';
import { formLogicFn } from '../src/components/formLogic.js';

describe('formLogic toString fix', () => {
  it('includes parseSurgeConfigInput definition in toString output', () => {
    const fnString = formLogicFn.toString();

    // Verify the function references parseSurgeConfigInput
    expect(fnString).toContain('parseSurgeConfigInput');

    // Verify the arrow function definitions ARE included
    expect(fnString).toMatch(/(?:const|var|let)\s+parseSurgeConfigInput\s*=/);
    expect(fnString).toMatch(/(?:const|var|let)\s+parseSurgeValue\s*=/);
    expect(fnString).toMatch(/(?:const|var|let)\s+convertSurgeIniToJson\s*=/);
  });

  it('does not contain __name calls that break in browser runtime', () => {
    const fnString = formLogicFn.toString();
    // Ensure no function declarations that esbuild would inject __name() for
    expect(fnString).not.toMatch(/^\s*function\s+parseSurgeValue\b/m);
    expect(fnString).not.toMatch(/^\s*function\s+convertSurgeIniToJson\b/m);
    expect(fnString).not.toMatch(/^\s*function\s+parseSurgeConfigInput\b/m);
  });

  it('formData() returns a valid Alpine data object', () => {
    // Simulate browser global environment using Function constructor
    const fakeWindow = { APP_TRANSLATIONS: {}, PREDEFINED_RULE_SETS: {} };
    const fn = new Function('window', '(' + formLogicFn.toString() + ')(); return window;');
    const result = fn(fakeWindow);
    const data = result.formData();
    expect(typeof data.submitForm).toBe('function');
    expect(typeof data.toggleAccordion).toBe('function');
    expect(data.showAdvanced).toBe(false);
  });

  it('keeps the chain parameter in the query string shared by all four links', () => {
    const src = formLogicFn.toString();

    // The short-link flow reuses one code for all four formats, so any
    // format-specific parameter would be overwritten by the last write.
    expect(src).toContain("params.set('chain', this.input)");

    const uses = src.match(/(?:xray|singbox|clash|surge): origin \+ '\/\w+\?' \+ finalQueryString/g) || [];
    expect(uses).toHaveLength(4);
  });

  it('does not auto-expand short links from the input watcher', () => {
    const src = formLogicFn.toString();
    expect(src).toContain('if (this.isShortLink(text) || !this.isSubscriptionUrl(text))');
  });

  it('resolves short links for preview and conversion without writing their config into the textarea', () => {
    const src = formLogicFn.toString();
    expect(src).toContain('async resolveShortLinkUrl(text)');
    expect(src).toContain('const parseSource = resolved?.searchParams.get(\'config\') || source');
    expect(src).toContain('new URLSearchParams(resolvedShortLink.search)');
    expect(src).toContain('params.set(\'overridesId\', overrideId)');
  });

  it('merges the short link extra nodes with the locally added ones', () => {
    const src = formLogicFn.toString();
    expect(src).toContain("resolved?.searchParams.get('extra')");
    expect(src).toContain("const mergedExtra = [existingExtra, this.extraNodes.join('\\n')].filter(Boolean).join('\\n')");
  });
});
