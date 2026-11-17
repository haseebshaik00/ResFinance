import architectureImage from "../../../docs/images/resfinance-architecture-data-flow.png";

const FLOW_PATHS = [
  "M646 146 V178",
  "M294 290 V321",
  "M768 290 V321",
  "M1240 290 V321",
  "M596 438 V476",
  "M290 583 V615",
  "M802 583 V615",
  "M1278 583 V615",
  "M488 686 H604",
  "M604 686 H488",
  "M769 754 V799",
  "M248 755 V852 Q248 868 264 868 H361",
  "M1287 755 V852 Q1287 868 1271 868 H1173",
] as const;

export function ArchitectureDiagram() {
  return (
    <figure
      className="architecture-diagram"
      aria-labelledby="architecture-diagram-caption"
    >
      <div className="architecture-diagram-stage">
        <img
          src={architectureImage}
          width="1533"
          height="1026"
          alt="ResFinance system architecture and data flow from the React frontend through Personal Finance, Friends and Groups, and Crypto Intelligence to FastAPI, ResWallet, ResContract, the crypto research pipeline, and ResilientDB."
        />
        <svg
          className="architecture-flow-overlay"
          viewBox="0 0 1533 1026"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
        >
          {FLOW_PATHS.map((path, index) => (
            <path
              className="architecture-flow-path"
              d={path}
              key={`${path}-${index}`}
              pathLength="100"
              style={{ animationDelay: `${index * -0.19}s` }}
            />
          ))}
        </svg>
      </div>
      <figcaption id="architecture-diagram-caption" className="sr-only">
        ResFinance System Architecture and Data Flow. The web application
        connects three integrated dashboards to a FastAPI backend. ResWallet,
        ResContract, the crypto research pipeline, and ResilientDB support
        authenticated actions, research, and encrypted append-only records.
      </figcaption>
    </figure>
  );
}

export { FLOW_PATHS };
