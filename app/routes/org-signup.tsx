import { FusionAuthClient } from "@fusionauth/typescript-client";
import type ClientResponse from "@fusionauth/typescript-client/build/src/ClientResponse";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useState } from "react";
import invariant from "tiny-invariant";
import AuthForm from "~/components/AuthForm";
import getFusionAuthClient from "~/services/get_fusion_auth_client";

const configuredRoles = [
  {
    name: "admin",
    description: "Admin role inside the organization",
    isDefault: false,
  },
  {
    name: "member",
    description: "Member role",
    isDefault: true,
  },
];

async function createTenant(organizationId: string) {
  const tenantConfig = {
    sourceTenantId: getFusionAuthClient("default").tenantId,
    tenant: {
      name: organizationId,
      issuer: "saasbp.io",
    },
  };
  const createTenantResult = await getFusionAuthClient("default").createTenant(
    "",
    tenantConfig,
  );

  if (!createTenantResult?.response?.tenant?.id) {
    throw new Error("Couldn't create tenant. FusionAuth response was empty!");
  }

  return createTenantResult.response.tenant.id;
}

const createApiKey = async (organizationName: string, tenantId: string) => {
  const apiKeyRequest = {
    apiKey: {
      metaData: {
        attributes: {
          description: `API key for ${organizationName}`,
        },
      },
      tenantId,
    },
  };

  const createAPIKeyResult = await getFusionAuthClient("default").createAPIKey(
    "",
    apiKeyRequest,
  );

  if (!createAPIKeyResult?.response?.apiKey?.key) {
    throw new Error(
      "FusionAuth API key create call was successful, but no API key was returned!",
    );
  }

  const fusionAuthTenantLockedApiKey = createAPIKeyResult.response.apiKey.key;

  return fusionAuthTenantLockedApiKey;
};

async function createApplication(organizationId: string, lockedApiKey: string) {
  const FUSIONAUTH_BASE_URL = process.env.FUSIONAUTH_BASE_URL!;

  const newFusionAuthClient = new FusionAuthClient(
    lockedApiKey,
    FUSIONAUTH_BASE_URL,
  );

  const newFusionAuthAppConfig = {
    name: `${organizationId} App`,
    roles: configuredRoles,
    loginConfiguration: {
      generateRefreshTokens: true,
    },
  };

  const createAppResult = await newFusionAuthClient.createApplication("", {
    application: newFusionAuthAppConfig,
    role: configuredRoles[0],
  });

  if (!createAppResult?.response?.application?.id) {
    throw new Error(
      "An error occurred while creating the FusionAuth application.",
    );
  }

  return createAppResult.response.application.id;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const user = Object.fromEntries(formData);

  invariant(user.organization, "Organization name is required");

  const orgName = user.organization as string;

  const tenantId = await createTenant(orgName);
  const lockedApiKey = await createApiKey(orgName, tenantId);
  const applicationId = await createApplication(orgName, lockedApiKey);
  try {
    const registrationRequest = {
      user,
      registration: {
        applicationId,
      },
    };
    await getFusionAuthClient(tenantId).register("", registrationRequest);
    return redirect(`${orgName}.saasbp.io/signin`);
  } catch (err) {
    const error = err as ClientResponse<string>;
    return json(
      { error: { message: error.response } },
      { status: error.statusCode },
    );
  }
};

export default function SignUp() {
  const [orgName, setOrgName] = useState("");
  return (
    <AuthForm id="signup-form" method="post">
      <div>
        <label className="block" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="form-input"
        />
      </div>
      <div>
        <label className="block" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="form-input"
          required
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
            e.target.reportValidity();
          }}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            // if password length is < 8 characters set and error
            const value = e.target.value;
            if (value.length < 8) {
              e.target.setCustomValidity(
                "Password must be at least 8 characters",
              );
            } else {
              e.target.setCustomValidity("");
            }
          }}
        />
      </div>
      <div>
        <label className="block" htmlFor="organization">
          Organization Name
        </label>
        <input
          id="organization"
          name="organization"
          type="text"
          value={orgName}
          className="form-input"
          required
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const value = e.target.value;
            // create a slug from value replacing spaces and removing non alphanumeric characters
            const slug = value
              .replace(/\s+/g, "-")
              .replace(/[^a-zA-Z0-9-]/g, "");
            setOrgName(slug);
          }}
        />
        <p className="block text-slate-700 text-sm mt-2">
          {orgName && `${orgName}.sass.io will be your custom domain.`}
        </p>
      </div>
      <button type="submit" className="btn btn-primary">
        Register
      </button>
    </AuthForm>
  );
}
