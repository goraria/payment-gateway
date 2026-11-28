import { createServiceVerification } from "@/modules/structure/service-verification";
import { applicationNamespaces, applicationScopes } from "@/utils/constant";
import { authUrl, nodeEnv } from "@/utils/environment";

export const {
  verifyServiceRequest,
  serviceAuthFailure,
  serviceResourceMetadata,
} = createServiceVerification({
  service: "payment",
  authUrl,
  nodeEnv,
  applications: applicationNamespaces,
  scopeFor: (application, access) => applicationScopes[application][access],
});
