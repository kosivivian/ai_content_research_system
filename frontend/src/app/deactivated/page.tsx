import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/components/layout/sign-out-button";

export default function DeactivatedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Account deactivated</CardTitle>
          <CardDescription>
            Your account has been deactivated. Contact an approver on your team if you think this is a
            mistake.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
