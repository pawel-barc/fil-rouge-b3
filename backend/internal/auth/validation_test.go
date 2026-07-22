package auth

import "testing"

func TestValidatePasswordRequiresFrontendPolicy(t *testing.T) {
	tests := []struct {
		name     string
		password string
		wantErr  string
	}{
		{name: "too short", password: "Aa1!", wantErr: "password too short"},
		{name: "missing lowercase", password: "PASSWORD1!", wantErr: "password lowercase required"},
		{name: "missing uppercase", password: "password1!", wantErr: "password uppercase required"},
		{name: "missing digit", password: "Password!", wantErr: "password digit required"},
		{name: "missing special", password: "Password1", wantErr: "password special character required"},
		{name: "outer whitespace", password: " Password1!", wantErr: "password cannot start or end with whitespace"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validatePassword(tt.password)
			if err == nil {
				t.Fatalf("expected validation error")
			}
			if err.Error() != tt.wantErr {
				t.Fatalf("expected %q, got %q", tt.wantErr, err.Error())
			}
		})
	}
}

func TestValidatePasswordAcceptsStrongPassword(t *testing.T) {
	if err := validatePassword("Password1!"); err != nil {
		t.Fatalf("expected strong password to pass, got %v", err)
	}
}
