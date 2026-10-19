"use client";

import "./user-lookup.scss";

import { Button, Field, FieldControl, FieldError, FieldLabel, Input } from "@nuvui/react";
import { useActionState } from "react";
import { type LookupState, lookupUser } from "@/app/users/actions";

const initialState: LookupState = { status: "idle" };

export function UserLookup() {
  const [state, action, pending] = useActionState(lookupUser, initialState);

  return (
    <form action={action} className="user-lookup">
      <Field invalid={state.status === "invalid"}>
        <FieldLabel>User id</FieldLabel>
        <FieldControl>
          <Input name="id" autoComplete="off" required />
        </FieldControl>
        <FieldError>{state.status === "invalid" ? state.message : null}</FieldError>
      </Field>
      <Button type="submit" disabled={pending} className="user-lookup__submit">
        Look up
      </Button>
      <p className="user-lookup__result" aria-live="polite">
        {state.status === "found" && `Found ${state.user.name}.`}
        {state.status === "not-found" && "No user with that id."}
      </p>
    </form>
  );
}
