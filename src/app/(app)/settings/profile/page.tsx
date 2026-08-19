"use client";
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { initials } from "@/lib/utils";

export default function ProfileSettingsPage() {
  const { toast } = useToast();
  const [name, setName] = React.useState("MindSupernova Labs");
  const [email] = React.useState("labs@mindsupernova.com");
  const [org, setOrg] = React.useState("MindSupernova");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Update your personal information.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <span className="flex size-16 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
              {initials(name)}
            </span>
            <Button variant="outline" size="sm">Change avatar</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={email} disabled />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="org">Organization</Label>
              <Input id="org" value={org} onChange={(e) => setOrg(e.target.value)} />
            </div>
          </div>
          <Button onClick={() => toast({ variant: "success", title: "Profile updated" })}>Save changes</Button>
        </CardContent>
      </Card>
    </div>
  );
}
