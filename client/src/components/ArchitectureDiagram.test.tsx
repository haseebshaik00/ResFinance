import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ArchitectureDiagram, FLOW_PATHS } from "./ArchitectureDiagram";

describe("ArchitectureDiagram", () => {
  it("keeps the reference image and flow overlay in one coordinate system", () => {
    const markup = renderToStaticMarkup(<ArchitectureDiagram />);

    expect(markup).toContain('width="1533"');
    expect(markup).toContain('height="1026"');
    expect(markup).toContain('viewBox="0 0 1533 1026"');
    expect(markup).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(markup.match(/class="architecture-flow-path"/g)).toHaveLength(
      FLOW_PATHS.length,
    );
  });
});
