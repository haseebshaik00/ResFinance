import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderAllocationSliceLabel } from "./CryptoDashboard";

describe("allocation donut labels", () => {
  it("shows the hovered SOL allocation in a high-contrast label card", () => {
    const markup = renderToStaticMarkup(
      renderAllocationSliceLabel(
        {
          cx: 200,
          cy: 200,
          index: 2,
          midAngle: 110,
          stroke: "var(--control-border)",
          textAnchor: "end",
          x: 150,
          y: 290,
          payload: {
            amount: 71_774,
            color: "var(--sol-color)",
            key: "SOL",
            name: "Solana",
            shortName: "SOL",
            value: 0.1457,
            weight: "0.1457",
          },
        },
        2,
      ),
    );

    expect(markup).toContain("allocation-donut-active-label-card");
    expect(markup).toContain("SOL");
    expect(markup).toContain("14.57%");
    expect(markup).toContain("$717.74");
  });
});
