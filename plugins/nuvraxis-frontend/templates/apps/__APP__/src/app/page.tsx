import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@nuvui/react";

export default function HomePage() {
  return (
    <main className="page">
      <Card className="page__card">
        <CardHeader>
          <CardTitle>__APP__</CardTitle>
          <CardDescription>
            Next.js, nuvui, and a Docker → Helm → ArgoCD delivery path.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild intent="secondary">
            <a href="https://nuvui.nuvraxis.com/docs">nuvui docs</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
