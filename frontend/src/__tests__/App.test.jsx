import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('App Test Setup', () => {
  it('Should correctly set up testing library', () => {
    render(<div>Prove Your Reign</div>);
    expect(screen.getByText('Prove Your Reign')).toBeInTheDocument();
  });
});
