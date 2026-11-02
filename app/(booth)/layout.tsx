import { Suspense } from "react";
import BoothGate from "@/components/BoothGate";

// Shared by Home, Study, Weekly Story and My Group, so the data, the study
// timer and the pop-out widget survive moving between tabs.
// AI Lodge showcase: no sign-in. The landing page is shown once, then the booth opens (see BoothGate).
export default function BoothLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <BoothGate>{children}</BoothGate>
    </Suspense>
  );
}
