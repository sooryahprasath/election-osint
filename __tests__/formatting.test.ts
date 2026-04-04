import { expect, test, describe } from 'vitest';
import { formatIndianCurrency, severityLabel, volatilityColor } from '../src/lib/utils/formatting';

describe('DHARMA-OSINT Formatting Utilities', () => {
    
    test('Format Indian Currency handles millions correctly', () => {
        expect(formatIndianCurrency(10000000)).toBe('₹1.0 Cr');
        expect(formatIndianCurrency(0)).toBe('₹0');
    });

    test('Severity Labels map correctly to thresholds', () => {
        // Assume mapping: 1-2 NORMAL, 3-4 TENSE, 5 EXTREME
        expect(severityLabel(1)).toBe('LOW');
        expect(severityLabel(3)).toBe('ELEVATED');
        expect(severityLabel(5)).toBe('CRITICAL');
    });

    test('Volatility colors map accurately', () => {
        // Red for > 80
        expect(volatilityColor(85)).toBe('#dc2626');
        // Orange for 60-79
        expect(volatilityColor(65)).toBe('#ea580c');
        // Green for 40-59
        expect(volatilityColor(45)).toBe('#16a34a');
        // Grey for < 20
        expect(volatilityColor(15)).toBe('#555555');
    });
});
